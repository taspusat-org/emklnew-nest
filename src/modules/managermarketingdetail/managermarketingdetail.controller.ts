import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ManagermarketingdetailService } from './managermarketingdetail.service';
import { CreateManagermarketingdetailDto } from './dto/create-managermarketingdetail.dto';
import { UpdateManagermarketingdetailDto } from './dto/update-managermarketingdetail.dto';
import { dbMssql } from 'src/common/utils/db';

@Controller('managermarketingdetail')
export class ManagermarketingdetailController {
  constructor(
    private readonly managermarketingdetailService: ManagermarketingdetailService,
  ) {}

  @Post()
  create(
    @Body() createManagermarketingdetailDto: CreateManagermarketingdetailDto,
  ) {
    return this.managermarketingdetailService.create(
      createManagermarketingdetailDto,
    );
  }

  @Get(':id')
  async findAll(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.managermarketingdetailService.findAll(id, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error fetching manager marketing detail:', error);
    }
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateManagermarketingdetailDto: UpdateManagermarketingdetailDto,
  ) {
    return this.managermarketingdetailService.update(
      id,
      updateManagermarketingdetailDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.managermarketingdetailService.remove(id);
  }
}
