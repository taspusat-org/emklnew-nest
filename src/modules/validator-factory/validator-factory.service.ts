import { Injectable } from '@nestjs/common';
import { CreateValidatorFactoryDto } from './dto/create-validator-factory.dto';
import { UpdateValidatorFactoryDto } from './dto/update-validator-factory.dto';
import { PelayaranService } from '../pelayaran/pelayaran.service';

@Injectable()
export class ValidatorFactoryService {
  constructor(private readonly pelayaranService: PelayaranService) {}

  serviceApproval(tableName: string, data: any, trx: any) {
    switch (tableName) {
      case 'PELAYARAN':
        return this.pelayaranService.approval(data, trx);

      // Tambahkan kasus lainnya sesuai dengan tabel yang ada
      default:
        throw new Error('Validator not found for table: ' + tableName);
    }
  }
  serviceNonApproval(tableName: string, data: any, trx: any) {
    switch (tableName) {
      case 'PELAYARAN':
        return this.pelayaranService.nonApproval(data, trx);

      // Tambahkan kasus lainnya sesuai dengan tabel yang ada
      default:
        throw new Error('Validator not found for table: ' + tableName);
    }
  }
  create(createValidatorFactoryDto: CreateValidatorFactoryDto) {
    return 'This action adds a new validatorFactory';
  }

  findAll() {
    return `This action returns all validatorFactory`;
  }

  findOne(id: string) {
    return `This action returns a #${id} validatorFactory`;
  }

  update(id: string, updateValidatorFactoryDto: UpdateValidatorFactoryDto) {
    return `This action updates a #${id} validatorFactory`;
  }

  remove(id: string) {
    return `This action removes a #${id} validatorFactory`;
  }
}
