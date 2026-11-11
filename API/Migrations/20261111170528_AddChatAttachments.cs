using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace API.Migrations
{
    /// <inheritdoc />
    public partial class AddChatAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AttachmentId",
                table: "Messages",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ChatAttachments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    MessageId = table.Column<int>(type: "int", nullable: true),
                    SenderId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    ReceiverId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    ChatFolder = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    OriginalFileName = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: false),
                    StoredFileName = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: false),
                    RelativePath = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    DownloadUrl = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    FileExtension = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    FileCategory = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    FileSize = table.Column<long>(type: "bigint", nullable: false),
                    IsEncrypted = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChatAttachments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_AttachmentId",
                table: "Messages",
                column: "AttachmentId");

            migrationBuilder.CreateIndex(
                name: "IX_ChatAttachments_MessageId",
                table: "ChatAttachments",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_ChatAttachments_SenderId_ReceiverId",
                table: "ChatAttachments",
                columns: new[] { "SenderId", "ReceiverId" });

            migrationBuilder.AddForeignKey(
                name: "FK_Messages_ChatAttachments_AttachmentId",
                table: "Messages",
                column: "AttachmentId",
                principalTable: "ChatAttachments",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Messages_ChatAttachments_AttachmentId",
                table: "Messages");

            migrationBuilder.DropTable(
                name: "ChatAttachments");

            migrationBuilder.DropIndex(
                name: "IX_Messages_AttachmentId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "AttachmentId",
                table: "Messages");
        }
    }
}
