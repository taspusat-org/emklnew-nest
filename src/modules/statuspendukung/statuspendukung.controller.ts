import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { StatuspendukungService } from './statuspendukung.service';
import { CreateStatuspendukungDto } from './dto/create-statuspendukung.dto';
import { UpdateStatuspendukungDto } from './dto/update-statuspendukung.dto';

@Controller('statuspendukung')
export class StatuspendukungController {
  constructor(
    private readonly statuspendukungService: StatuspendukungService,
  ) {}
  @Get()
  findAll() {
    return this.statuspendukungService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.statuspendukungService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateStatuspendukungDto: UpdateStatuspendukungDto,
  ) {
    // return this.statuspendukungService.update(id, updateStatuspendukungDto);
  }
}
