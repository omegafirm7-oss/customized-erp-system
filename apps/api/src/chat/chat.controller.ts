import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { memoryStorage } from "multer";
import { Response } from "express";
import { PERMISSIONS } from "@erp/shared-constants";
import { Permissions, SensitivePermission } from "../common/decorators/permissions.decorator";
import { CurrentCompanyId } from "../common/decorators/current-company-id.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types/jwt-payload.type";
import { ChatService } from "./chat.service";
import { AddMembersDto, CreateChannelDto, DirectChannelDto, InvitePersonDto, PostMessageDto, RenameChannelDto } from "./dto/chat.dtos";

/** Admins (anyone who can manage users) may manage every channel, not just the ones they created. */
const isAdmin = (user: JwtPayload) => user.permissions.includes(PERMISSIONS.IAM_USER_MANAGE);

// Team chat is on for every company; the chat.use permission decides which roles may use it.
@ApiTags("chat")
@ApiBearerAuth()
@Controller("chat")
@Permissions(PERMISSIONS.CHAT_USE)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get("people")
  people(@CurrentCompanyId() companyId: string) {
    return this.chatService.listPeople(companyId);
  }

  /** Adds a colleague by email with chat-only access. Needs the same right as adding a user under Users. */
  @Post("invite")
  @Permissions(PERMISSIONS.CHAT_USE, PERMISSIONS.IAM_USER_MANAGE)
  @SensitivePermission()
  invite(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: InvitePersonDto) {
    return this.chatService.invitePerson(companyId, user.sub, dto);
  }

  @Get("channels")
  channels(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload) {
    return this.chatService.listChannels(companyId, user.sub);
  }

  @Get("unread")
  unread(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload) {
    return this.chatService.unreadTotal(companyId, user.sub);
  }

  @Post("channels")
  createChannel(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateChannelDto) {
    return this.chatService.createChannel(companyId, user.sub, dto);
  }

  @Post("direct")
  direct(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Body() dto: DirectChannelDto) {
    return this.chatService.openDirect(companyId, user.sub, dto.userId);
  }

  @Get("channels/:id")
  channel(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.chatService.channelDetails(companyId, id, user.sub, isAdmin(user));
  }

  @Post("channels/:id/members")
  addMembers(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.chatService.addMembers(companyId, id, user.sub, dto.userIds, isAdmin(user));
  }

  @Patch("channels/:id")
  rename(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: RenameChannelDto,
  ) {
    return this.chatService.renameChannel(companyId, id, user.sub, dto.name, isAdmin(user));
  }

  @Delete("channels/:id/members/:userId")
  removeMember(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
  ) {
    return this.chatService.removeMember(companyId, id, user.sub, targetUserId, isAdmin(user));
  }

  @Delete("channels/:id")
  deleteChannel(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.chatService.deleteChannel(companyId, id, user.sub, isAdmin(user));
  }

  @Get("channels/:id/messages")
  messages(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Query("changedAfter") changedAfter?: string,
    @Query("before") before?: string,
  ) {
    const parse = (v?: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date");
      return d;
    };
    return this.chatService.listMessages(companyId, id, user.sub, { changedAfter: parse(changedAfter), before: parse(before) });
  }

  @Post("channels/:id/messages")
  @ApiConsumes("multipart/form-data", "application/json")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  post(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() dto: PostMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.chatService.postMessage(companyId, id, user.sub, dto.body, file);
  }

  @Post("channels/:id/read")
  read(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.chatService.markRead(companyId, id, user.sub);
  }

  @Delete("messages/:id")
  deleteMessage(@CurrentCompanyId() companyId: string, @CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.chatService.deleteMessage(companyId, id, user.sub);
  }

  @Get("attachments/:id")
  async attachment(
    @CurrentCompanyId() companyId: string,
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.chatService.getAttachment(companyId, id, user.sub);
    const isImage = file.mimeType.startsWith("image/");
    res.set({
      "Content-Type": file.mimeType,
      "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    });
    return new StreamableFile(file.data);
  }
}
