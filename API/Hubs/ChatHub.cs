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
        var userName = Context.User!.Identity!.Name;
        var currentUser = await _userManger.FindByNameAsync(userName!);
        var connectionId = Context.ConnectionId ;
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
                ProfilePicture = currentUser!.ProfileImage ,
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

    public async Task SendMessage(MessageRequestDto message)
    {
        var senderId = Context.User!.Identity!.Name;
        var recipientId = message.ReceiverId;
        var newMessage = new Meesage
        {
            Sender = await _userManger.FindByIdAsync(senderId!),
            Receiver = await _userManger.FindByIdAsync(recipientId!),
            IsRead = false,
            CreatedData = DateTime.UtcNow,
            Content = message.Content
        };
        _context.Messages.Add(newMessage);
        await _context.SaveChangesAsync();
        await Clients.All.SendAsync("ReceiveMessage", newMessage);

    }

    public async Task LoadMessages(string recipientId,int pageNumber=1)
    {
        int pageSize=10;
        var senderId = Context.User!.Identity!.Name;
        var currentUser = await _userManger.FindByIdAsync(senderId!);
        if (currentUser == null)
            return;
        
        List<MessageResponseDTO> messages = await _context.Messages
            .Where(m => (m.SenderId == senderId && m.ReceiverId == recipientId) ||
                        (m.SenderId == recipientId && m.ReceiverId == senderId))
            .OrderByDescending(m => m.CreatedData)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .OrderBy(m => m.CreatedData)
            .Select(m=> new MessageResponseDTO
            {
                Id = m.Id,
                SenderId = m.SenderId,
                ReceiverId = m.ReceiverId,
                Content = m.Content
            }).ToListAsync();

        foreach(var message in messages)
        {
            var msg = await _context.Messages.FirstOrDefaultAsync(m => m.Id == message.Id);
            if(msg != null  && msg.ReceiverId == senderId)
            {
                msg.IsRead = true;
                await _context.SaveChangesAsync();
            }

            await Clients.User(currentUser.Id).SendAsync("MessageRead", message.Id);
        }

        await Clients.Caller.SendAsync("LoadMessages", messages);
    }
    public async Task NotifyTyping(string recipientUserName)
    {
        var senderUserName = Context.User!.Identity!.Name;
        if (string.IsNullOrEmpty(senderUserName) || string.IsNullOrEmpty(recipientUserName))
        {
            return;
        }
        var connectionId = onlineUsers.Values.FirstOrDefault(u => u.UserName == recipientUserName)?.ConnectionId;
        if(connectionId != null)
            await Clients.Client(connectionId).SendAsync("TypingNotification", senderUserName);
}

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userName = Context.User!.Identity!.Name;
        if (userName != null && onlineUsers.TryRemove(userName, out var removedUser))
        {
            await Clients.All.SendAsync("UserDisconnected", removedUser);
        }
        await Clients.All.SendAsync("OnlineUsers",await GetAllUsers());
    }
    private async Task<IEnumerable<OnlineUserDto>> GetAllUsers()
{
    var username = Context.User!.GetUserName();
    var onlineUsersSet = new HashSet<string>(onlineUsers.Keys);

    var users = await _userManger.Users.Select(x => new OnlineUserDto
    {
        Id = x.Id,
        UserName = x.UserName,
        FullName = x.FullName,
        ProfilePicture = x.ProfileImage,
        IsOnline = onlineUsersSet.Contains(x.UserName!),
        UnreadCount = _context.Messages.Count(message =>
                message.ReceiverId == username &&
                message.SenderId == x.Id &&
                !message.IsRead)
    }).OrderByDescending(u => u.IsOnline).ToListAsync();

    return users;
    }
}
