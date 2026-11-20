import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { JenisOrderanController } from './jenisorderan.controller';
import { JenisOrderanService } from './jenisorderan.service';

describe('JenisOrderanController', () => {
  let controller: JenisOrderanController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JenisOrderanController],
      providers: [JenisOrderanService],
    })
      .useMocker(autoMocker)
      .compile();

    controller = module.get<JenisOrderanController>(JenisOrderanController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
