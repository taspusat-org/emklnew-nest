import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ManagermarketingheaderService } from './managermarketingheader.service';

describe('ManagermarketingheaderService', () => {
  let service: ManagermarketingheaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ManagermarketingheaderService],
    }).useMocker(autoMocker).compile();

    service = module.get<ManagermarketingheaderService>(
      ManagermarketingheaderService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
