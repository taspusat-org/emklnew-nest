import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { MasterbiayaController } from './masterbiaya.controller';
import { MasterbiayaService } from './masterbiaya.service';

describe('MasterbiayaController', () => {
  let controller: MasterbiayaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MasterbiayaController],
      providers: [MasterbiayaService],
    }).useMocker(autoMocker).compile();

    controller = module.get<MasterbiayaController>(MasterbiayaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
