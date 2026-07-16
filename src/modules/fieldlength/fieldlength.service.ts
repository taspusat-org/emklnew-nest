import { Injectable } from '@nestjs/common';
import { CreateFieldlengthDto } from './dto/create-fieldlength.dto';
import { UpdateFieldlengthDto } from './dto/update-fieldlength.dto';
import { dbMssql } from 'src/common/utils/db';

@Injectable()
export class FieldlengthService {
  create(createFieldlengthDto: CreateFieldlengthDto) {
    return 'This action adds a new fieldlength';
  }
  async getColumnLength(tableName: any) {
    try {
      const result = await dbMssql(tableName).columnInfo();

      const data = Object.keys(result).map((column) => ({
        column: column,
        length: result[column].maxLength,
      }));

      return data;
    } catch (error) {
      console.error('Error getting column lengths:', error.message);
      throw error; // Lempar error agar bisa ditangani di luar fungsi
    }
  }

  findAll() {
    return `This action returns all fieldlength`;
  }

  findOne(id: string) {
    return `This action returns a #${id} fieldlength`;
  }

  update(id: string, updateFieldlengthDto: UpdateFieldlengthDto) {
    return `This action updates a #${id} fieldlength`;
  }

  remove(id: string) {
    return `This action removes a #${id} fieldlength`;
  }
}
