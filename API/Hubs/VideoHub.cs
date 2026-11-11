using System;
using Microsoft.AspNetCore.SignalR;

namespace API.Hubs;

public class VideoHub : Hub
{
    public async Task SendOffer(string reciverId, string offer )
    {
        await Clients.User(reciverId).SendAsync("ReceiveOffer", Context.UserIdentifier,offer);
    }

    public async Task SendAnswer(string reciverId, string answer)
    {
        await Clients.User(reciverId).SendAsync("ReceiveAnswer", Context.UserIdentifier, answer);
    }

    public async Task SendIceCandidate(string reciverId, string iceCandidate)
    {
        await Clients.User(reciverId).SendAsync("ReceiveIceCandidate", Context.UserIdentifier, iceCandidate);
    }

    public async Task EndCall(string reciverId)
    {
        await Clients.User(reciverId).SendAsync("CallEnded", Context.UserIdentifier);
    }
}
