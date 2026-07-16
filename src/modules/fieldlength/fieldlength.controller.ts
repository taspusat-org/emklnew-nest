import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  BadRequestException,
} from '@nestjs/common';
import { FieldlengthService } from './fieldlength.service';
import { CreateFieldlengthDto } from './dto/create-fieldlength.dto';
import { UpdateFieldlengthDto } from './dto/update-fieldlength.dto';

@Controller('fieldlength')
export class FieldlengthController {
  constructor(private readonly fieldlengthService: FieldlengthService) {}

  @Post()
  async getColumnLength(@Body() body: { table: string }) {
    try {
      const { table } = body;
      // Check if table name is provided
      if (!table) {
        throw new BadRequestException('Table name is required.');
      }

      // Fetch column lengths using the service
      const fieldLength = await this.fieldlengthService.getColumnLength(table);

      // Return the field length in the response
      return { data: fieldLength };
    } catch (error) {
      console.error('Error fetching field length:', error);
      throw new BadRequestException('Failed to fetch field lengths');
    }
  }

  @Get()
  findAll() {
    return this.fieldlengthService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fieldlengthService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateFieldlengthDto: UpdateFieldlengthDto,
  ) {
    return this.fieldlengthService.update(id, updateFieldlengthDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fieldlengthService.remove(id);
  }
}
