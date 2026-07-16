import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { JabatanController } from './jabatan.controller';
import { JabatanService } from './jabatan.service';

describe('JabatanController', () => {
  let controller: JabatanController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JabatanController],
      providers: [JabatanService],
    }).useMocker(autoMocker).compile();

    controller = module.get<JabatanController>(JabatanController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
