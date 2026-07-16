import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
} from '@nestjs/common';
import { TesmoduleService } from './tesmodule.service';
import { CreateTesmoduleDto } from './dto/create-tesmodule.dto';
import { UpdateTesmoduleDto } from './dto/update-tesmodule.dto';

@Controller('tesmodule')
export class TesmoduleController {
  constructor(private readonly tesmoduleService: TesmoduleService) {}

  @Post()
  //@TESSSSSS
  create(@Body() createTesmoduleDto: CreateTesmoduleDto) {
    return this.tesmoduleService.create(createTesmoduleDto);
  }

  @Get()
  //@TESSSSSS
  findAll() {
    return this.tesmoduleService.findAll();
  }

  @Get(':id')
  //@TESSSSSS
  findOne(@Param('id') id: string) {
    return this.tesmoduleService.findOne(id);
  }

  @Put(':id')
  //@TESSSSSS
  update(
    @Param('id') id: string,
    @Body() updateTesmoduleDto: UpdateTesmoduleDto,
  ) {
    return this.tesmoduleService.update(id, updateTesmoduleDto);
  }
  @Delete(':id')
  //@TESSSSSS
  remove(@Param('id') id: string) {
    return this.tesmoduleService.remove(id);
  }
}
