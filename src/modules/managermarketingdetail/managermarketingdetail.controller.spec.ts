import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ManagermarketingdetailController } from './managermarketingdetail.controller';
import { ManagermarketingdetailService } from './managermarketingdetail.service';

describe('ManagermarketingdetailController', () => {
  let controller: ManagermarketingdetailController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManagermarketingdetailController],
      providers: [ManagermarketingdetailService],
    }).useMocker(autoMocker).compile();

    controller = module.get<ManagermarketingdetailController>(
      ManagermarketingdetailController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
