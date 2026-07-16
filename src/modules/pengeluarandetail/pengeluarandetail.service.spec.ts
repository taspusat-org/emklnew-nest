import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PengeluarandetailService } from './pengeluarandetail.service';

describe('PengeluarandetailService', () => {
  let service: PengeluarandetailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PengeluarandetailService],
    }).useMocker(autoMocker).compile();

    service = module.get<PengeluarandetailService>(PengeluarandetailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
