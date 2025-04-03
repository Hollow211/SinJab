import React from "react";

import { type ChakraProps, Image, chakra } from "@chakra-ui/react";

export const Logo: React.FC<ChakraProps> = (props) => {
  return (
    <Image
      src="/android-chrome-192x192.png"
      height={props.height || props.h}
      width={props.width || props.w}
      boxSize={props.boxSize}
    />
  );
};
