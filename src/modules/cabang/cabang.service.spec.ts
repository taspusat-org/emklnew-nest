import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { CabangService } from './cabang.service';

describe('CabangService', () => {
  let service: CabangService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CabangService],
    }).useMocker(autoMocker).compile();

    service = module.get<CabangService>(CabangService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
