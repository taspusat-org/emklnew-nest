import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PanjarmuatandetailService } from './panjarmuatandetail.service';

describe('PanjarmuatandetailService', () => {
  let service: PanjarmuatandetailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PanjarmuatandetailService],
    }).useMocker(autoMocker).compile();

    service = module.get<PanjarmuatandetailService>(PanjarmuatandetailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
