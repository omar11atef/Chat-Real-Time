using System.ComponentModel.DataAnnotations;

namespace API.Entities;

public class MessageReaction
{
    [Key]
    public int Id { get; set; }

    public int MessageId { get; set; }

    [Required]
    [MaxLength(450)]
    public string UserId { get; set; } = string.Empty;

    [Required]
    [MaxLength(32)]
    public string Emoji { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
