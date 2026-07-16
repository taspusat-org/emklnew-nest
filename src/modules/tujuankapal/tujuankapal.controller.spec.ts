import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { TujuankapalController } from './tujuankapal.controller';
import { TujuankapalService } from './tujuankapal.service';

describe('TujuankapalController', () => {
  let controller: TujuankapalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TujuankapalController],
      providers: [TujuankapalService],
    }).useMocker(autoMocker).compile();

    controller = module.get<TujuankapalController>(TujuankapalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
