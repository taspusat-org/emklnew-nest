import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { BiayaController } from './biaya.controller';
import { BiayaService } from './biaya.service';

describe('BiayaController', () => {
  let controller: BiayaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BiayaController],
      providers: [BiayaService],
    }).useMocker(autoMocker).compile();

    controller = module.get<BiayaController>(BiayaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
