import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PengeluaranheaderService } from './pengeluaranheader.service';

describe('PengeluaranheaderService', () => {
  let service: PengeluaranheaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PengeluaranheaderService],
    }).useMocker(autoMocker).compile();

    service = module.get<PengeluaranheaderService>(PengeluaranheaderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
