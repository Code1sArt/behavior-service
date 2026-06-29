import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles) {
            return true; // ถ้าไม่ได้ใส่ @Roles() ไว้ แปลว่าเข้าได้ทุกคน (ที่ผ่าน JWT แล้ว)
        }

        const { user } = context.switchToHttp().getRequest();

        const hasRole = requiredRoles.some((role) => user.role === role);
        if (!hasRole) {
            throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้');
        }

        return true;
    }
}
