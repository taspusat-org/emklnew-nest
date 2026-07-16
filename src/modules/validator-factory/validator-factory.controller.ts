import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ValidatorFactoryService } from './validator-factory.service';
import { CreateValidatorFactoryDto } from './dto/create-validator-factory.dto';
import { UpdateValidatorFactoryDto } from './dto/update-validator-factory.dto';

@Controller('validator-factory')
export class ValidatorFactoryController {
  constructor(
    private readonly validatorFactoryService: ValidatorFactoryService,
  ) {}

  @Post()
  create(@Body() createValidatorFactoryDto: CreateValidatorFactoryDto) {
    return this.validatorFactoryService.create(createValidatorFactoryDto);
  }

  @Get()
  findAll() {
    return this.validatorFactoryService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.validatorFactoryService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateValidatorFactoryDto: UpdateValidatorFactoryDto,
  ) {
    return this.validatorFactoryService.update(id, updateValidatorFactoryDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.validatorFactoryService.remove(id);
  }
}
