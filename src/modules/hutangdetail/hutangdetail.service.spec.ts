import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { HutangdetailService } from './hutangdetail.service';

describe('HutangdetailService', () => {
  let service: HutangdetailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HutangdetailService],
    }).useMocker(autoMocker).compile();

    service = module.get<HutangdetailService>(HutangdetailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
