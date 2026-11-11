using System;
using System.Collections.Concurrent;
using API.Data;
using API.DTOS;
using API.Entities;
using API.Extenions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace API.Hubs;

[Authorize]
public class ChatHub(UserManager<AppUser> userManger, AppDbcontext context) : Hub
{
    private readonly UserManager<AppUser> _userManger = userManger;
    private readonly AppDbcontext _context = context;

    public static readonly ConcurrentDictionary<string,OnlineUserDto> onlineUsers = [];

    public override async Task OnConnectedAsync()
    {
        var httpContext = Context.GetHttpContext();
        var receviedId = httpContext?.Request.Query["SenderId"].ToString();
        var userName = Context.User!.GetUserName();
        if (string.IsNullOrEmpty(userName))
        {
            return;
        }
        var currentUser = await _userManger.FindByNameAsync(userName);
        if (currentUser == null)
        {
            return;
        }
        var connectionId = Context.ConnectionId;
        if (onlineUsers.ContainsKey(userName))
        {
            onlineUsers[userName].ConnectionId = connectionId;
        }
        else
        {
            var user = new OnlineUserDto
            {
                ConnectionId= connectionId,
                UserName= userName,
                Email = currentUser.Email,
                ProfilePicture = currentUser.ProfileImage,
                FullName = currentUser.FullName,
            };

            onlineUsers.TryAdd(userName,user);

            await Clients.AllExcept(connectionId).SendAsync("Notify",currentUser);
        }
        if (!String.IsNullOrEmpty(receviedId))
        {
          await LoadMessages(receviedId);
        }
        await Clients.All.SendAsync("OnlineUsers",await GetAllUsers());
    }

    private async Task<AppUser?> ResolveCurrentUserAsync()
    {
        var userId = Context.User!.GetUserIdString();
        if (!string.IsNullOrEmpty(userId))
        {
            var byId = await _userManger.FindByIdAsync(userId);
            if (byId != null) return byId;
        }

        var userName = Context.User!.GetUserName();
        return !string.IsNullOrEmpty(userName)
            ? await _userManger.FindByNameAsync(userName)
            : null;
    }

    public async Task SendMessage(MessageRequestDto message)
    {
        if (message == null || string.IsNullOrWhiteSpace(message.ReceiverId) || string.IsNullOrWhiteSpace(message.Content))
        {
            return;
        }

        var sender = await ResolveCurrentUserAsync();
        var receiver = await _userManger.FindByIdAsync(message.ReceiverId);
        if (sender == null || receiver == null)
        {
            return;
        }

        var newMessage = new Meesage
        {
            SenderId = sender.Id,
            ReceiverId = receiver.Id,
            IsRead = false,
            CreatedData = DateTime.UtcNow,
            Content = message.Content.Trim()
        };
        _context.Messages.Add(newMessage);
        await _context.SaveChangesAsync();

        var response = new MessageResponseDTO
        {
            Id = newMessage.Id,
            SenderId = newMessage.SenderId,
            ReceiverId = newMessage.ReceiverId,
            Content = newMessage.Content,
            CreatedData = newMessage.CreatedData,
            IsRead = newMessage.IsRead
        };

        await Clients.Caller.SendAsync("ReceiveMessage", response);

        if (receiver.Id != sender.Id &&
            !string.IsNullOrEmpty(receiver.UserName) &&
            onlineUsers.TryGetValue(receiver.UserName, out var onlineRecipient) &&
            !string.IsNullOrEmpty(onlineRecipient.ConnectionId))
        {
            await Clients.Client(onlineRecipient.ConnectionId).SendAsync("ReceiveMessage", response);
        }
    }

    private async Task MarkIncomingUnreadAsReadAsync(string currentUserId, string peerUserId, IEnumerable<int>? candidateIds = null)
    {
        var query = _context.Messages
            .Where(m => m.ReceiverId == currentUserId && m.SenderId == peerUserId && !m.IsRead);

        if (candidateIds != null)
        {
            var idList = candidateIds.ToList();
            if (idList.Count == 0) return;
            query = query.Where(m => idList.Contains(m.Id));
        }

        var unreadEntities = await query.ToListAsync();
        if (unreadEntities.Count == 0)
        {
            return;
        }

        foreach (var msg in unreadEntities)
        {
            msg.IsRead = true;
        }
        await _context.SaveChangesAsync();

        var peer = await _userManger.FindByIdAsync(peerUserId);
        if (peer != null &&
            !string.IsNullOrEmpty(peer.UserName) &&
            onlineUsers.TryGetValue(peer.UserName, out var peerOnline) &&
            !string.IsNullOrEmpty(peerOnline.ConnectionId))
        {
            var readIds = unreadEntities.Select(m => m.Id).ToList();
            await Clients.Client(peerOnline.ConnectionId).SendAsync("MessageRead", readIds);
        }
    }

    public async Task MarkAsRead(string senderId)
    {
        var currentUser = await ResolveCurrentUserAsync();
        if (currentUser == null || string.IsNullOrWhiteSpace(senderId))
        {
            return;
        }

        await MarkIncomingUnreadAsReadAsync(currentUser.Id, senderId);
    }

    public async Task LoadMessages(string recipientId, int pageNumber = 1)
    {
        const int pageSize = 10;
        var currentUser = await ResolveCurrentUserAsync();
        if (currentUser == null || string.IsNullOrWhiteSpace(recipientId))
        {
            return;
        }

        var senderId = currentUser.Id;

        List<MessageResponseDTO> messages = await _context.Messages
            .Where(m => (m.SenderId == senderId && m.ReceiverId == recipientId) ||
                        (m.SenderId == recipientId && m.ReceiverId == senderId))
            .OrderByDescending(m => m.CreatedData)
            .ThenByDescending(m => m.Id)
            .Skip((Math.Max(1, pageNumber) - 1) * pageSize)
            .Take(pageSize)
            .OrderBy(m => m.CreatedData)
            .ThenBy(m => m.Id)
            .Select(m => new MessageResponseDTO
            {
                Id = m.Id,
                SenderId = m.SenderId,
                ReceiverId = m.ReceiverId,
                Content = m.Content,
                CreatedData = m.CreatedData,
                IsRead = m.IsRead
            }).ToListAsync();

        var unreadIds = messages
            .Where(m => m.ReceiverId == senderId && !m.IsRead)
            .Select(m => m.Id)
            .ToList();

        if (unreadIds.Count > 0)
        {
            await MarkIncomingUnreadAsReadAsync(senderId, recipientId, unreadIds);
        }

        await Clients.Caller.SendAsync("LoadMessages", messages);
    }
    public async Task NotifyTyping(string recipientUserName)
    {
        var senderUserName = Context.User!.GetUserName();
        if (string.IsNullOrEmpty(senderUserName) || string.IsNullOrEmpty(recipientUserName))
        {
            return;
        }
        var connectionId = onlineUsers.Values
            .FirstOrDefault(u => string.Equals(u.UserName, recipientUserName, StringComparison.OrdinalIgnoreCase))
            ?.ConnectionId;
        if (connectionId != null)
            await Clients.Client(connectionId).SendAsync("TypingNotification", senderUserName);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userName = Context.User!.GetUserName();
        if (!string.IsNullOrEmpty(userName) &&
            onlineUsers.TryGetValue(userName, out var existing) &&
            existing.ConnectionId == Context.ConnectionId &&
            onlineUsers.TryRemove(userName, out var removedUser))
        {
            await Clients.All.SendAsync("UserDisconnected", removedUser);
        }
        await Clients.All.SendAsync("OnlineUsers", await GetAllUsers());
    }
    private async Task<IEnumerable<OnlineUserDto>> GetAllUsers()
{
    var currentUserId = Context.User!.GetUserIdString();
    var onlineUsersSet = new HashSet<string>(onlineUsers.Keys);

    var users = await _userManger.Users.Select(x => new OnlineUserDto
    {
        Id = x.Id,
        UserName = x.UserName,
        Email = x.Email,
        FullName = x.FullName,
        ProfilePicture = x.ProfileImage,
        IsOnline = onlineUsersSet.Contains(x.UserName!),
        UnreadCount = _context.Messages.Count(message =>
                message.ReceiverId == currentUserId &&
                message.SenderId == x.Id &&
                !message.IsRead)
    }).OrderByDescending(u => u.IsOnline).ToListAsync();

    return users;
    }
}
