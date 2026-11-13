import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { CreateLinkInvitationDto } from './dto/create-link-invitation.dto';
import {
  Controller,
  Post,
  Body,
  Patch,
  UseGuards,
  Request,
  Get,
  Delete,
  Param,
} from '@nestjs/common';
import { ParentsService } from './parents.service';
import { CreateParentDto } from './dto/create-parent.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AddChildDto } from './dto/add-child.dto';
import {
  AddChildrenDto,
  CreateClassroomInvitationDto,
  ResolveClassroomInvitationDto,
} from './dto/classroom-invitation.dto';
import { ParentInvitationThrottleGuard } from './parent-invitation-throttle.guard';

@ApiTags('Parents Management')
@Controller('parents')
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  @Post('classroom-invitations')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.ADMIN, Role.AFFAIRS)
  issueClassroomInvitation(
    @Body() dto: CreateClassroomInvitationDto,
    @Request() req: any,
  ) {
    return this.parentsService.issueClassroomInvitation(
      dto.classroomId,
      req.user,
    );
  }

  @Post('classroom-invitations/resolve')
  @UseGuards(ParentInvitationThrottleGuard)
  resolveClassroomInvitation(@Body() dto: ResolveClassroomInvitationDto) {
    return this.parentsService.resolveClassroomInvitation(dto.invitationCode);
  }

  @Patch('children')
  @UseGuards(AuthGuard('jwt'), RolesGuard, ParentInvitationThrottleGuard)
  @Roles(Role.PARENT, Role.TEACHER)
  addChildren(@Body() dto: AddChildrenDto, @Request() req: any) {
    return this.parentsService.addChildren(req.user, dto.students);
  }

  @Delete('children/:studentId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.PARENT, Role.TEACHER)
  removeChild(@Param('studentId') studentId: string, @Request() req: any) {
    return this.parentsService.removeChild(req.user, studentId);
  }

  @Post('link-invitations')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.ADMIN, Role.AFFAIRS)
  issueInvitation(@Body() dto: CreateLinkInvitationDto, @Request() req: any) {
    return this.parentsService.issueInvitation(dto, req.user);
  }

  // Public signup requires a school invitation; an authenticated ADMIN may provision directly.
  @Post('register')
  @UseGuards(OptionalJwtGuard, ParentInvitationThrottleGuard)
  @ApiOperation({ summary: 'ลงทะเบียนผู้ปกครองใหม่ (รองรับ LINE Mini App)' })
  @ApiResponse({
    status: 201,
    description: 'ลงทะเบียนและเชื่อมโยงบุตรหลานสำเร็จ',
  })
  @ApiResponse({ status: 404, description: 'ไม่พบรหัสนักเรียน' })
  @ApiResponse({
    status: 409,
    description: 'รหัสประชาชนผู้ปกครอง หรือ LINE ID ถูกใช้งานแล้ว',
  })
  register(@Body() createParentDto: CreateParentDto, @Request() req: any) {
    return this.parentsService.register(createParentDto, req.user);
  }

  @Patch('add-child')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard, ParentInvitationThrottleGuard)
  @Roles(Role.PARENT, Role.ADMIN) // เฉพาะผู้ปกครองเท่านั้นที่กดเพิ่มลูกเองได้
  @ApiOperation({
    summary: 'เพิ่มบุตรหลานในปกครอง (สำหรับผู้ปกครองที่ Login แล้ว)',
  })
  addChild(@Request() req: any, @Body() dto: AddChildDto) {
    // ดึง ID ของผู้ปกครองมาจาก Token (req.user.userId)
    const targetParentId = dto.parentId ? dto.parentId : req.user.userId;

    return this.parentsService.addChild(targetParentId, dto, req.user);
  }

  @ApiBearerAuth()
  @Get('all')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.ADMIN, Role.AFFAIRS)
  @ApiOperation({
    summary: 'ดึงรายชื่อผู้ปกครองทั้งหมดพร้อมนักเรียนในความดูแล (Admin/Staff)',
  })
  async getAllParents() {
    return await this.parentsService.findAll();
  }

  @ApiBearerAuth()
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'ลบข้อมูลผู้ปกครอง (Admin เท่านั้น หรือตามนโยบาย)' })
  async removeParent(@Param('id') id: string) {
    return await this.parentsService.removeParent(id);
  }
}
