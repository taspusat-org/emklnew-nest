import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { HutangheaderService } from './hutangheader.service';

describe('HutangheaderService', () => {
  let service: HutangheaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HutangheaderService],
    }).useMocker(autoMocker).compile();

    service = module.get<HutangheaderService>(HutangheaderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
