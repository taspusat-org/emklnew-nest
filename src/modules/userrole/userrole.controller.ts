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
  UseGuards,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserroleService } from './userrole.service';
import { CreateUserroleDto } from './dto/create-userrole.dto';
import {
  UpdateUserroleDto,
  UpdateUserroleSchema,
} from './dto/update-userrole.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';

@Controller('userrole')
export class UserroleController {
  constructor(private readonly userroleService: UserroleService) {}

  @Post()
  create(@Body() createUserroleDto: CreateUserroleDto) {
    return this.userroleService.create(createUserroleDto);
  }

  @Get(':id')
  findAll(@Param('id') id: string) {
    return this.userroleService.findAll(id);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserroleSchema))
    data: UpdateUserroleDto,
    @Req() req: any,
  ) {
    const modifiedBy = req.user?.user?.username || 'unknown';

    const trx = await dbMssql.transaction();

    try {
      const result = await this.userroleService.update(
        Number(id),
        data,
        modifiedBy,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating user roles:', error);
      throw new InternalServerErrorException('Failed to update user roles');
    }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userroleService.remove(id);
  }
}
