using API.Extenions;
using Microsoft.AspNetCore.SignalR;

namespace API.Services;

/// <summary>
/// Resolves SignalR's <c>Context.UserIdentifier</c> from JWT identity claims across inbound claim formats.
/// </summary>
public class ClaimsUserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection)
    {
        var userId = connection.User?.GetUserIdString();
        return string.IsNullOrWhiteSpace(userId) ? null : userId;
    }
}
