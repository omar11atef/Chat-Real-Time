using System.Collections.Concurrent;
using API.Extenions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace API.Hubs;

[Authorize]
public class VideoHub : Hub
{
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> ConnectedUsers = new();

    private string? GetSenderId()
    {
        var id = Context.User?.GetUserIdString();
        return !string.IsNullOrWhiteSpace(id) ? id : Context.UserIdentifier;
    }

    public override Task OnConnectedAsync()
    {
        var userId = GetSenderId();
        if (!string.IsNullOrWhiteSpace(userId))
        {
            var connections = ConnectedUsers.GetOrAdd(userId, _ => new ConcurrentDictionary<string, byte>());
            connections[Context.ConnectionId] = 0;
        }
        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = GetSenderId();
        if (!string.IsNullOrWhiteSpace(userId) && ConnectedUsers.TryGetValue(userId, out var connections))
        {
            connections.TryRemove(Context.ConnectionId, out _);
            if (connections.IsEmpty)
            {
                ConnectedUsers.TryRemove(userId, out _);
            }
        }
        return base.OnDisconnectedAsync(exception);
    }

    public async Task SendOffer(string reciverId, string offer)
    {
        var senderId = GetSenderId();
        if (string.IsNullOrWhiteSpace(reciverId) || string.IsNullOrWhiteSpace(senderId)) return;

        if (!ConnectedUsers.TryGetValue(reciverId, out var connections) || connections.IsEmpty)
        {
            await Clients.Caller.SendAsync("UserOffline", reciverId);
            return;
        }

        await Clients.User(reciverId).SendAsync("ReceiveOffer", senderId, offer);
    }

    public async Task SendAnswer(string reciverId, string answer)
    {
        var senderId = GetSenderId();
        if (string.IsNullOrWhiteSpace(reciverId) || string.IsNullOrWhiteSpace(senderId)) return;
        await Clients.User(reciverId).SendAsync("ReceiveAnswer", senderId, answer);
    }

    public async Task SendIceCandidate(string reciverId, string iceCandidate)
    {
        var senderId = GetSenderId();
        if (string.IsNullOrWhiteSpace(reciverId) || string.IsNullOrWhiteSpace(senderId)) return;
        await Clients.User(reciverId).SendAsync("ReceiveIceCandidate", senderId, iceCandidate);
    }

    public async Task SendMediaState(string reciverId, bool isVideoOn, bool isAudioOn)
    {
        var senderId = GetSenderId();
        if (string.IsNullOrWhiteSpace(reciverId) || string.IsNullOrWhiteSpace(senderId)) return;
        await Clients.User(reciverId).SendAsync("ReceiveMediaState", senderId, isVideoOn, isAudioOn);
    }

    public async Task EndCall(string reciverId)
    {
        var senderId = GetSenderId();
        if (string.IsNullOrWhiteSpace(reciverId) || string.IsNullOrWhiteSpace(senderId)) return;
        await Clients.User(reciverId).SendAsync("CallEnded", senderId);
    }
}
