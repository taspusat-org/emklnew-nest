import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { AsalkapalController } from './asalkapal.controller';
import { AsalkapalService } from './asalkapal.service';

describe('AsalkapalController', () => {
  let controller: AsalkapalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsalkapalController],
      providers: [AsalkapalService],
    }).useMocker(autoMocker).compile();

    controller = module.get<AsalkapalController>(AsalkapalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
