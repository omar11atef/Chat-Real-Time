using System;
using System.Security.Claims;

namespace API.Extenions;

public static class ClaimsPrincipleExtenions
{
    public static string GetUserName(this ClaimsPrincipal user)
    {
        return user.FindFirstValue(ClaimTypes.Name)
            ?? user.FindFirstValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
            ?? user.FindFirstValue("unique_name")
            ?? user.Identity?.Name
            ?? string.Empty;
    }

    public static Guid GetUserId (this ClaimsPrincipal user)
    {
        var idStr = user.GetUserIdString();
        return Guid.TryParse(idStr, out var g) ? g : Guid.Empty;
    }

    public static string GetUserIdString(this ClaimsPrincipal user)
    {
        return user.FindFirstValue(ClaimTypes.NameIdentifier) 
            ?? user.FindFirstValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier")
            ?? user.FindFirstValue("nameid")
            ?? user.FindFirstValue("sub")
            ?? string.Empty;
    }
}
