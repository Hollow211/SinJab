import Image from "next/image";

import { Box, Center } from "@chakra-ui/react";

import { IconSchool } from "@tabler/icons-react";

import { squareCdnLoader } from "../../common/cdn-loaders";

export interface ClassLogoProps {
  url?: string | null;
  width: number;
  height: number;
  local?: boolean;
}

export const ClassLogo: React.FC<ClassLogoProps> = ({
  url,
  width,
  height,
  local = false,
}) => {
  const Logo = ({ src }: { src: string }) => (
    <Box
      style={{
        width,
        height,
        position: "relative",
      }}
    >
      <Image
        src={src}
        alt="Class logo"
        loader={!local ? squareCdnLoader : undefined}
        width={!local ? width : undefined}
        height={!local ? height : undefined}
        fill={local}
        style={{
          objectFit: "cover",
        }}
      />
    </Box>
  );

  if (url) return <Logo src={url} />;

  return (
    <Center
      style={{
        width,
        height,
      }}
      bg="white"
    >
      <Box color="gray.900">
        <IconSchool size={32} />
      </Box>
    </Center>
  );
};
