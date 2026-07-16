import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ManagermarketingdetailService } from './managermarketingdetail.service';

describe('ManagermarketingdetailService', () => {
  let service: ManagermarketingdetailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ManagermarketingdetailService],
    }).useMocker(autoMocker).compile();

    service = module.get<ManagermarketingdetailService>(
      ManagermarketingdetailService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
