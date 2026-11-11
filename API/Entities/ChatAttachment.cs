using System.ComponentModel.DataAnnotations;

namespace API.Entities;

public class ChatAttachment
{
    [Key]
    public int Id { get; set; }

    public int? MessageId { get; set; }

    [Required]
    [MaxLength(450)]
    public string SenderId { get; set; } = string.Empty;

    [Required]
    [MaxLength(450)]
    public string ReceiverId { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string ChatFolder { get; set; } = string.Empty;

    [Required]
    [MaxLength(260)]
    public string OriginalFileName { get; set; } = string.Empty;

    [Required]
    [MaxLength(260)]
    public string StoredFileName { get; set; } = string.Empty;

    [Required]
    [MaxLength(500)]
    public string RelativePath { get; set; } = string.Empty;

    [Required]
    [MaxLength(500)]
    public string DownloadUrl { get; set; } = string.Empty;

    [Required]
    [MaxLength(150)]
    public string ContentType { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string FileExtension { get; set; } = string.Empty;

    [Required]
    [MaxLength(30)]
    public string FileCategory { get; set; } = string.Empty;

    public long FileSize { get; set; }

    public bool IsEncrypted { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
