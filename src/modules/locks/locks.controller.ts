import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
  UseGuards,
  Req,
  UsePipes,
  Query,
} from '@nestjs/common';
import { LocksService } from './locks.service';
import { CreateLockDto } from './dto/create-lock.dto';
import { UpdateLockDto } from './dto/update-lock.dto';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';

@Controller('locks')
export class LocksController {
  constructor(private readonly locksService: LocksService) {}
  @Get()
  //@OPEN-LOCKS
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'editing_by',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1,
      limit: limit === 0 || !limit ? undefined : limit,
    };

    const params: FindAllParams = {
      search,
      filters,
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true',
    };
    const trx = await dbMssql.transaction();

    try {
      const result = await this.locksService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Post('open-locks')
  //@OPEN-LOCKS
  @UseGuards(AuthGuard)
  async openForceEdit(@Body() data: any, @Req() req) {
    // Assuming trx is some form of transaction handling passed from TypeORM or a similar DB library.
    // In TypeORM you can use the QueryBuilder or use transaction API if needed.'
    const modifiedby = req.user?.user?.username || 'unknown';
    const trx = await dbMssql.transaction();
    try {
      const result = await this.locksService.openForceEdit(
        data,
        trx,
        modifiedby,
      );
      await trx.commit();
      return {
        statusCode: HttpStatus.OK,
        message: 'Force edit opened successfully.',
        data: result,
      };
    } catch (error) {
      await trx.rollback();
      throw new Error(`Error: ${error.message}`);
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locksService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLockDto: UpdateLockDto) {
    return this.locksService.update(id, updateLockDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locksService.remove(id);
  }
}
