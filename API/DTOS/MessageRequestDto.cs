using System;

namespace API.Entities;

public class MessageRequestDto
{
    public int Id {get;set;}
    public string? SenderId {get;set;}
    public string? ReceiverId {get;set;}
    public string? Content {get;set;}
    public bool IsRead {get;set;}
    public DateTime CreatedAt {get;set;}
}
