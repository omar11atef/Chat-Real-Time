using API.Entities;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace API.Data;

public class AppDbcontext(DbContextOptions<AppDbcontext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Meesage> Messages { get; set; }
    public DbSet<ChatAttachment> ChatAttachments { get; set; }
    public DbSet<MessageReaction> MessageReactions { get; set; }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Meesage>()
            .HasOne(m => m.Attachment)
            .WithMany()
            .HasForeignKey(m => m.AttachmentId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.Entity<MessageReaction>()
            .HasOne<Meesage>()
            .WithMany(m => m.Reactions)
            .HasForeignKey(r => r.MessageId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<MessageReaction>()
            .HasIndex(r => new { r.MessageId, r.UserId })
            .IsUnique();

        builder.Entity<ChatAttachment>()
            .HasIndex(a => new { a.SenderId, a.ReceiverId });

        builder.Entity<ChatAttachment>()
            .HasIndex(a => a.MessageId);
    }
}
