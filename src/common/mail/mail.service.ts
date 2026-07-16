import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { Users } from 'src/common/interfaces/users.interface';
interface SendPasswordResignInput {
  email: string;
  name: string;
  alasanberhenti: string;
  namakaryawan: string;
}
interface CutiParam {
  email: string[];
  ccemail: string[];
  name: string;
  namakaryawan: string;
  jabatan: string;
  cabang: string;
  tglPengajuan: string;
  jumlahCuti: string;
  tglCuti: string;
  alasanPengajuan: string;
  alasanpenolakan?: string;
  status: string;
  statussubject: string;
}
interface IzinParam {
  email: string[];
  ccemail: string[];
  name: string;
  namakaryawan: string;
  jabatan: string;
  cabang: string;
  tglPengajuan: string;
  tglIzin: string;
  jamIzin: string;
  alasanIzin: string;
  status: string;
  statussubject: string;
}
interface KaryawanBaru {
  email: string[];
  ccemail: string[];
  namakaryawan: string;
  alamat: string;
  gender: string;
  jabatan: string;
  foto: string;
  cabang: string;
  tglmasukkerja: string;
  username: string;
  tglinput: string;
}
interface KaryawanResign {
  email: string[];
  ccemail: string[];
  namakaryawan: string;
  alamat: string;
  gender: string;
  jabatan: string;
  foto: string;
  cabang: string;
  tglmasukkerja: string;
  tglresign: string;
  alasanresign: string;
  username: string;
  tglinput: string;
}
interface KaryawanMutasi {
  email: string[];
  ccemail: string[];
  namakaryawan: string;
  alamat: string;
  gender: string;
  jabatan: string;
  foto: string;
  cabang: string;
  tglmasukkerja: string;
  tglmutasi: string;
  username: string;
  tglinput: string;
}
@Injectable()
export class MailService {
  constructor(private mailerService: MailerService) {}

  async sendUserConfirmation(user: Users, token: string) {
    const url = `http://localhost:3000`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
      template: './confirmation', // `.hbs` extension is appended automatically
      context: {
        name: user.name,
        url,
      },
    });
  }
  async sendPasswordResetEmail(user: Users, token: string) {
    const url = `http://localhost:3000/auth/reset-password?token=${token}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
      template: './confirmation', // `.hbs` extension is appended automatically
      context: {
        name: user.name,
        url,
      },
    });
  }

  async sendPasswordResign({
    email,
    name,
    namakaryawan,
    alasanberhenti,
  }: SendPasswordResignInput) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
      template: './resign',
      context: {
        name: name,
        namakaryawan: namakaryawan,
        alasanberhenti: alasanberhenti,
      },
    });
  }
  async sendEmailCuti({
    email,
    name,
    jabatan,
    cabang,
    namakaryawan,
    tglPengajuan,
    jumlahCuti,
    tglCuti,
    alasanPengajuan,
    status,
    ccemail,
    statussubject,
  }: CutiParam) {
    await this.mailerService.sendMail({
      to: email,
      cc: ccemail,
      subject: `Permohonan Cuti ${namakaryawan} ${statussubject}`,
      template: './cuti',

      context: {
        name: name,
        jabatan: jabatan,
        cabang: cabang,
        namakaryawan: namakaryawan,
        tglPengajuan: tglPengajuan,
        jumlahCuti: jumlahCuti,
        tglCuti: tglCuti,
        alasanPengajuan: alasanPengajuan,
        status: status,
      },
    });
  }
  async sendEmailRejectCuti({
    email,
    name,
    jabatan,
    cabang,
    namakaryawan,
    tglPengajuan,
    jumlahCuti,
    tglCuti,
    alasanPengajuan,
    alasanpenolakan,
    status,
    ccemail,
    statussubject,
  }: CutiParam) {
    await this.mailerService.sendMail({
      to: email,
      cc: ccemail,
      subject: `Permohonan Cuti ${namakaryawan} ${statussubject}`,
      template: './rejectcuti',

      context: {
        name: name,
        jabatan: jabatan,
        cabang: cabang,
        namakaryawan: namakaryawan,
        tglPengajuan: tglPengajuan,
        jumlahCuti: jumlahCuti,
        tglCuti: tglCuti,
        alasanPengajuan: alasanPengajuan,
        alasanpenolakan: alasanpenolakan,
        status: status,
      },
    });
  }
  async sendEmailIzin({
    email,
    name,
    jabatan,
    cabang,
    namakaryawan,
    tglPengajuan,
    tglIzin,
    jamIzin,
    alasanIzin,
    status,
    ccemail,
    statussubject,
  }: IzinParam) {
    await this.mailerService.sendMail({
      to: email,
      cc: ccemail,
      subject: `Permohonan Izin ${namakaryawan} ${statussubject}`,
      template: './izin',

      context: {
        name: name,
        jabatan: jabatan,
        cabang: cabang,
        namakaryawan: namakaryawan,
        tglPengajuan: tglPengajuan,
        tglIzin: tglIzin,
        jamIzin: jamIzin,
        alasanIzin: alasanIzin,
        status: status,
      },
    });
  }

  async emailKaryawanBaru({
    email,
    ccemail,
    namakaryawan,
    alamat,
    gender,
    jabatan,
    foto,
    cabang,
    tglmasukkerja,
    username,
    tglinput,
  }: KaryawanBaru) {
    await this.mailerService.sendMail({
      to: email,
      cc: ccemail,
      subject: 'Pemberitahuan Karyawan Baru',
      template: './karyawanbaru',
      context: {
        namakaryawan: namakaryawan,
        alamat: alamat,
        gender: gender,
        jabatan: jabatan,
        foto: foto,
        cabang: cabang,
        tglmasukkerja: tglmasukkerja,
        username: username,
        tglinput: tglinput,
      },
    });
  }
  async emailKaryawanResign({
    email,
    ccemail,
    namakaryawan,
    alamat,
    gender,
    jabatan,
    foto,
    cabang,
    tglmasukkerja,
    tglresign,
    alasanresign,
    username,
    tglinput,
  }: KaryawanResign) {
    await this.mailerService.sendMail({
      to: email,
      cc: ccemail,
      subject: 'Pemberitahuan Karyawan Resign',
      template: './resign',
      context: {
        namakaryawan: namakaryawan,
        alamat: alamat,
        gender: gender,
        jabatan: jabatan,
        foto: foto,
        cabang: cabang,
        tglmasukkerja: tglmasukkerja,
        tglresign: tglresign,
        alasanresign: alasanresign,
        username: username,
        tglinput: tglinput,
      },
    });
  }
  async emailKaryawanMutasi({
    email,
    ccemail,
    namakaryawan,
    alamat,
    gender,
    jabatan,
    foto,
    cabang,
    tglmasukkerja,
    tglmutasi,
    username,
    tglinput,
  }: KaryawanMutasi) {
    await this.mailerService.sendMail({
      to: email,
      cc: ccemail,
      subject: 'Pemberitahuan Karyawan Mutasi',
      template: './mutasi',
      context: {
        namakaryawan: namakaryawan,
        alamat: alamat,
        gender: gender,
        jabatan: jabatan,
        foto: foto,
        cabang: cabang,
        tglmasukkerja: tglmasukkerja,
        tglmutasi: tglmutasi,
        username: username,
        tglinput: tglinput,
      },
    });
  }
}
