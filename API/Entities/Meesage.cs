using System;
using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace API.Entities;

public class Meesage
{
    [Key]
    public int Id {get;set;}
    public string? SenderId {get;set;}
    public string? ReceiverId {get;set;}
    public string? Content {get;set;}
    public DateTime CreatedData {get;set;}
    public bool IsRead {get;set;}
    public AppUser? Sender {get;set;}
    public AppUser? Receiver {get;set;}
}
