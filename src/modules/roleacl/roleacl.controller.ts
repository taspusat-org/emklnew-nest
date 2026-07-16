import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Put,
  BadRequestException,
  Req,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { RoleaclService } from './roleacl.service';
import { CreateRoleaclDto } from './dto/create-roleacl.dto';
import { UpdateRoleaclDto } from './dto/update-roleacl.dto';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';

@Controller('roleacl')
export class RoleaclController {
  constructor(private readonly roleaclService: RoleaclService) {}

  @Post()
  create(@Body() createRoleaclDto: CreateRoleaclDto) {
    return this.roleaclService.create(createRoleaclDto);
  }

  @Get()
  findAll(@Query('id') id: string) {
    // role ids are varchar strings (e.g. "02-E2CF9E01-..."); do NOT coerce with
    // +id — that yields NaN and breaks the query / triggers a 500.
    return this.roleaclService.findAll(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roleaclService.findOne(id);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string, // Role ID (varchar UUID, jangan di-parseInt)
    @Body() body: { data: number[] }, // Expecting { data: [1, 2, 3, 4] }
    @Req() req: any, // Request object to get user info (from JWT, session, etc.)
  ) {
    if (!id) {
      throw new BadRequestException('Invalid role ID');
    }

    const modifiedBy = req.user?.user?.username || 'unknown'; // Get the username from request or set default

    const trx = await dbMssql.transaction();
    try {
      // Call the service to update the role ACLs
      const result = await this.roleaclService.update(
        id,
        body.data, // Pass the ACO IDs from request body
        modifiedBy,
        trx,
      );

      // Commit the transaction after successful update
      await trx.commit();
      return result;
    } catch (error) {
      // Rollback the transaction in case of an error
      await trx.rollback();
      console.error('Error updating role ACL:', error);
      throw new InternalServerErrorException('Failed to update role ACL');
    }
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roleaclService.remove(id);
  }
}
