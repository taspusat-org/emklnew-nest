import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PengeluarandetailController } from './pengeluarandetail.controller';
import { PengeluarandetailService } from './pengeluarandetail.service';

describe('PengeluarandetailController', () => {
  let controller: PengeluarandetailController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PengeluarandetailController],
      providers: [PengeluarandetailService],
    }).useMocker(autoMocker).compile();

    controller = module.get<PengeluarandetailController>(
      PengeluarandetailController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
