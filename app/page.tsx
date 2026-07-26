import {redirect} from 'next/navigation';

/** The product table is the app. Nothing else belongs at the root. */
export default function Home() {
  redirect('/products');
}
