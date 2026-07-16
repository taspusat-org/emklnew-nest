import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PanjarmuatandetailController } from './panjarmuatandetail.controller';
import { PanjarmuatandetailService } from './panjarmuatandetail.service';

describe('PanjarmuatandetailController', () => {
  let controller: PanjarmuatandetailController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PanjarmuatandetailController],
      providers: [PanjarmuatandetailService],
    }).useMocker(autoMocker).compile();

    controller = module.get<PanjarmuatandetailController>(
      PanjarmuatandetailController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
