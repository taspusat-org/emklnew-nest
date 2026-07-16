import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { DaftarblService } from './daftarbl.service';

describe('DaftarblService', () => {
  let service: DaftarblService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DaftarblService],
    }).useMocker(autoMocker).compile();

    service = module.get<DaftarblService>(DaftarblService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
