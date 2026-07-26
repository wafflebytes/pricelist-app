'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {VStack} from '@astryxdesign/core/Layout';
import {Center} from '@astryxdesign/core/Center';
import {Card} from '@astryxdesign/core/Card';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Text, Heading} from '@astryxdesign/core/Text';
import {getClient} from '@/lib/supabase/client';

export function LoginForm({next}: {next?: string}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const {error: signInError} = await getClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Deliberately not distinguishing "no such user" from "wrong password".
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'That email and password combination is not recognised.'
          : signInError.message,
      );
      setIsLoading(false);
      return;
    }

    // Full reload so the middleware picks up the fresh session cookie.
    router.replace(next && next.startsWith('/') ? next : '/products');
    router.refresh();
  }

  return (
    <Center height="100dvh">
      <VStack gap={4} width={400} style={{maxWidth: '100%'}}>
        <VStack gap={1}>
          <Heading level={1}>Aalino Price List</Heading>
          <Text type="body" color="secondary">
            Internal vendor price history. Sign in to continue.
          </Text>
        </VStack>

        <Card padding={5}>
          <form onSubmit={handleSubmit} noValidate>
            <FormLayout>
              {error ? <Banner status="error" title={error} /> : null}

              <TextInput
                type="email"
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="you@aalino.com"
                isRequired
              />
              <TextInput
                type="password"
                label="Password"
                value={password}
                onChange={setPassword}
                isRequired
              />
              <Button
                type="submit"
                label="Sign in"
                variant="primary"
                width="100%"
                isLoading={isLoading}
                isDisabled={!email || !password}
              />
            </FormLayout>
          </form>
        </Card>

        <Text type="supporting" color="secondary">
          Accounts are created by an administrator. There is no self-signup.
        </Text>
      </VStack>
    </Center>
  );
}
