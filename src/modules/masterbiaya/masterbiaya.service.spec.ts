import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { MasterbiayaService } from './masterbiaya.service';

describe('MasterbiayaService', () => {
  let service: MasterbiayaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MasterbiayaService],
    }).useMocker(autoMocker).compile();

    service = module.get<MasterbiayaService>(MasterbiayaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
