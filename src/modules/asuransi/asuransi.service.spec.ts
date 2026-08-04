import { Test, TestingModule } from '@nestjs/testing';
import { AsuransiService } from './asuransi.service';

describe('AsuransiService', () => {
  let service: AsuransiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AsuransiService],
    }).compile();

    service = module.get<AsuransiService>(AsuransiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
