import { Module } from "@nestjs/common";
import { PhotoUploadService } from "./photo-upload.service";
import { PhotoUploadController } from "./photo-upload.controller";

@Module({
  controllers: [PhotoUploadController],
  providers: [PhotoUploadService],
})
export class PhotoUploadModule {}
