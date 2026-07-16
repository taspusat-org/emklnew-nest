import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  BadRequestException,
  UseGuards,
  Put,
  Req,
  InternalServerErrorException,
} from '@nestjs/common';
import { UseraclService } from './useracl.service';
import { CreateUseraclDto } from './dto/create-useracl.dto';
import { UpdateUseraclDto } from './dto/update-useracl.dto';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';

@Controller('useracl')
export class UseraclController {
  constructor(private readonly useraclService: UseraclService) {}

  @Post()
  create(@Body() createUseraclDto: CreateUseraclDto) {
    return this.useraclService.create(createUseraclDto);
  }

  @Get()
  async findAll(@Query('id') id: string) {
    return this.useraclService.findAll(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.useraclService.findOne(id);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string, // Role ID
    @Body() body: { data: number[] }, // Expecting { data: [1, 2, 3, 4] }
    @Req() req: any, // Request object to get user info (from JWT, session, etc.)
  ) {
    const modifiedBy = req.user?.user?.username || 'unknown'; // Get the username from request or set default

    const trx = await dbMssql.transaction();
    try {
      // Call the service to update the user ACLs
      const result = await this.useraclService.update(
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
      console.error('Error updating user ACL:', error);
      throw new InternalServerErrorException('Failed to update user ACL');
    }
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.useraclService.remove(id);
  }
}
