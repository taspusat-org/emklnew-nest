import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { AcosController } from './acos.controller';
import { AcosService } from './acos.service';

describe('AcosController', () => {
  let controller: AcosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AcosController],
      providers: [AcosService],
    }).useMocker(autoMocker).compile();

    controller = module.get<AcosController>(AcosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
