import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { JenisOrderanService } from './jenisorderan.service';

describe('JenisOrderanService', () => {
  let service: JenisOrderanService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JenisOrderanService],
    })
      .useMocker(autoMocker)
      .compile();

    service = module.get<JenisOrderanService>(JenisOrderanService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
