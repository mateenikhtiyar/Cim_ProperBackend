export interface User {
    _id: string;
    email: string;
    fullName: string;
    role?: 'buyer' | 'seller' | 'admin';
    [key: string]: any; // for any other props you have
  }
  